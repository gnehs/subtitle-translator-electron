export default function Header({ children }: { children: React.ReactNode }) {
  return (
    <header className="text-xl font-bold text-slate-800 bg-[#F8F7F6]  px-2 py-3 flex items-end sticky top-0 z-10 bg-opacity-80 backdrop-blur-xl">
      {children}
    </header>
  );
}
