export function Page() {
  return (
    <div className="w-full flex flex-col items-center gap-2">
      {/* page preview */}
      <div className="w-48 h-48 bg-background border-2 border-border"></div>
      {/* title */}
      <div className="text-center text-sm font-medium text-foreground">
        Page 1
      </div>
    </div>
  );
}