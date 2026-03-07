// runs in MAIN world at document_start on instagram.com pages.
// intercepts XHR to capture instagram's slide/graphql DM thread responses.
(function () {
  if (window.__igDmFetchState !== undefined) return; // already patched
  window.__igDmFetchState = {};
  window.__igSlideThreads = {};  // thread_fbid → { edges, pageInfo, headers, bodyStr }
  window.__igThreadKeyMap = {}; // thread_key / old thread_id → thread_fbid
  window.__igLastThreadFbid = null;

  var origOpen = XMLHttpRequest.prototype.open;
  var origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  var origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._igUrl = String(url || '');
    this._igHeaders = {};
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this._igHeaders) this._igHeaders[name] = value;
    return origSetRequestHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    var self = this;
    var url = this._igUrl || '';

    if (!url.includes('graphql')) {
      return origSend.apply(this, arguments);
    }

    // capture body as string for doc_id / variables extraction
    var bodyStr = '';
    if (!body) {
      bodyStr = '';
    } else if (typeof body === 'string') {
      bodyStr = body;
    } else if (body instanceof FormData) {
      body.forEach(function (v, k) {
        bodyStr += (bodyStr ? '&' : '') + k + '=' + (typeof v === 'string' ? v : '[blob]');
      });
    } else {
      try { bodyStr = String(body); } catch (_) {}
    }

    var capturedHeaders = self._igHeaders ? Object.assign({}, self._igHeaders) : {};

    this.addEventListener('load', function () {
      if (self.status !== 200) return;
      try {
        var data = JSON.parse(self.responseText);
        if (!data || !data.data) return;

        // build thread_key → thread_fbid mapping from mailbox responses
        var mailboxKey = Object.keys(data.data).find(function (k) {
          return k.includes('mailbox') || k.includes('inbox');
        });
        if (mailboxKey) {
          var folders = data.data[mailboxKey] && data.data[mailboxKey].threads_by_folder;
          var mEdges = (folders && folders.edges) || [];
          mEdges.forEach(function (edge) {
            var t = edge.node && edge.node.as_ig_direct_thread;
            if (!t) return;
            var fbid = t.id || t.thread_fbid;
            if (!fbid) return;
            if (t.thread_key) window.__igThreadKeyMap[t.thread_key] = fbid;
            window.__igThreadKeyMap[fbid] = fbid;
          });
        }

        // store thread messages from get_slide_thread_nullable
        var slideThread = data.data.get_slide_thread_nullable || data.data.fetch__SlideThread;
        if (!slideThread) return;

        var igThread = slideThread.as_ig_direct_thread;
        if (!igThread) return;

        var slideMessages = igThread.slide_messages || {};
        var msgEdges = slideMessages.edges || [];

        // thread_fbid is at igThread.id for get_slide_thread_nullable,
        // but only inside each edge's node for fetch__SlideThread
        var threadFbid = igThread.id || igThread.thread_fbid ||
          (msgEdges[0] && msgEdges[0].node && String(msgEdges[0].node.thread_fbid || '')) || '';
        if (!threadFbid) return;

        var pageInfo = slideMessages.page_info || {};

        if (!window.__igSlideThreads[threadFbid]) {
          window.__igSlideThreads[threadFbid] = { edges: [], pageInfo: {}, headers: capturedHeaders, bodyStr: bodyStr };
        }
        var stored = window.__igSlideThreads[threadFbid];
        msgEdges.forEach(function (e) { stored.edges.push(e); });
        stored.pageInfo = pageInfo;
        if (msgEdges.length > 0) {
          stored.headers = capturedHeaders;
          stored.bodyStr = bodyStr;
        }

        if (igThread.thread_key) window.__igThreadKeyMap[igThread.thread_key] = threadFbid;
        window.__igThreadKeyMap[threadFbid] = threadFbid;
        window.__igLastThreadFbid = threadFbid;
      } catch (_) {}
    });

    return origSend.apply(this, arguments);
  };
})();
