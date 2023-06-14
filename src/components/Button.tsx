import { createElement } from "react";
export default function Button({
  children,
  active = false,
  className = "",
  onClick,
  variant,
  icon,
  href,
  target = "_blank",
  submit = false,
}: {
  children?: React.ReactNode;
  active?: Boolean;
  onClick?: any;
  variant?: string;
  className?: string;
  icon?: string;
  href?: string;
  target?: string;
  submit?: boolean;
}) {
  let variantClass = `bg-slate-100 hover:bg-slate-200 active:bg-slate-300`;
  let variantActiveClass = `bg-slate-300 font-bold`;
  if (variant === "danger") {
    variantClass = `bg-red-100 hover:bg-red-200 active:bg-red-300 text-red-500 font-bold`;
    variantActiveClass = `bg-red-300 font-bold`;
  }
  return createElement(
    href ? "a" : "button",
    {
      className: `p-2 rounded cursor-pointer
      ${icon ? `flex justify-center items-center gap-1 py-1` : ``}
      ${active ? variantActiveClass : variantClass} ${className}`,
      onClick,
      href,
      target,
      type: submit ? "submit" : null,
    },
    <>
      {icon && <i className={`text-xl bx ${icon}`}></i>}
      {children}
    </>
  );
}
