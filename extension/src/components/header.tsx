export function Header() {
  return (
    <div className="flex items-center gap-2.5 mb-4.5">
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0"
        style={{ background: 'linear-gradient(135deg, #7b5ea7, #4a90d9)' }}
      >
        ☁
      </div>
      <h1 className="text-[15px] font-semibold tracking-[0.02em] text-[#f0f0ff]">
        IG DM Scraper
      </h1>
    </div>
  );
}
