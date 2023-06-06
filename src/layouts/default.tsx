import { Outlet, Link, useLocation } from "react-router-dom";
function NavItem({ to, icon }: { to: string; icon: string }) {
  const isActive = useLocation().pathname === to;
  return (
    <Link
      to={to}
      className={`flex items-center justify-center text-[24px] ${
        isActive ? `bg-slate-200` : `hover:bg-slate-200`
      } group p-2 rounded-lg transition-colors duration-200`}
    >
      <i
        className={`bx ${icon} group-active:scale-95 transition-all duration-200`}
      ></i>
    </Link>
  );
}
function DefaultLayout() {
  return (
    <div className="flex h-[100vh]">
      <div className="flex flex-col w-[52px] h-full bg-slate-50 p-1">
        <NavItem to="/" icon="bx-transfer-alt" />
        <div className="flex-1"></div>
        <NavItem to="/" icon="bxs-cloud-upload" />
        <NavItem to="/settings" icon="bx-cog" />
        <NavItem to="/about" icon="bx-info-circle" />
      </div>
      <div className="flex-1">
        <Outlet />
      </div>
    </div>
  );
}
export default DefaultLayout;
