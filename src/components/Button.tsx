import type {
  MouseEventHandler,
  ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";

interface ButtonProps {
  children?: ReactNode;
  active?: boolean;
  onClick?: MouseEventHandler<HTMLElement>;
  variant?: "secondary" | "danger" | "primary";
  className?: string;
  icon?: LucideIcon;
  href?: string;
  target?: string;
  submit?: boolean;
}

export default function Button({
  children,
  active = false,
  className = "",
  onClick,
  variant,
  icon: Icon,
  href,
  target = "_blank",
  submit = false,
}: ButtonProps) {
  let variantClass = "bg-slate-100 hover:bg-slate-200 active:bg-slate-300";
  let variantActiveClass = "bg-slate-300 font-bold";

  if (variant === "danger") {
    variantClass =
      "bg-red-100 hover:bg-red-200 active:bg-red-300 text-red-500 font-bold";
    variantActiveClass = "bg-red-300 font-bold";
  }

  if (variant === "primary") {
    variantClass =
      "bg-slate-500 hover:bg-slate-600 active:bg-slate-700 text-white font-bold";
    variantActiveClass = "bg-slate-700 font-bold";
  }

  const buttonClassName = `p-2 rounded cursor-pointer
    ${Icon ? "flex justify-center items-center gap-1 py-1" : ""}
    ${active ? variantActiveClass : variantClass} ${className}`;
  const content = (
    <>
      {Icon && <Icon size={20} strokeWidth={2} aria-hidden="true" />}
      {children}
    </>
  );

  if (href) {
    return (
      <a
        className={buttonClassName}
        onClick={onClick}
        href={href}
        target={target}
        rel={target === "_blank" ? "noreferrer" : undefined}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      className={buttonClassName}
      onClick={onClick}
      type={submit ? "submit" : "button"}
    >
      {content}
    </button>
  );
}
