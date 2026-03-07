interface ScanButtonProps {
  onClick: () => void;
  disabled: boolean;
}

export function ScanButton({ onClick, disabled }: ScanButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full py-2.75 px-4 text-white text-sm font-semibold tracking-[0.01em] rounded-[10px] border-none cursor-pointer transition-[opacity,transform] duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:opacity-[0.88] hover:enabled:-translate-y-px active:enabled:translate-y-0"
      style={{ background: 'linear-gradient(135deg, #7b5ea7, #4a90d9)' }}
    >
      Scan &amp; Archive Chat
    </button>
  );
}
