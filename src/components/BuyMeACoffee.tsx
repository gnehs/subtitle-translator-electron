import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "@/i18n";
import { ArrowUpRight, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import coffeeBannerIllustration from "@/assets/coffee-banner-illustration.png";

interface BuyMeACoffeeProps {
  className?: string;
  dismissible?: boolean;
}

export default function BuyMeACoffee({
  className,
  dismissible = false,
}: BuyMeACoffeeProps) {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "@container relative overflow-hidden rounded-[28px] border border-[#e3ad00]/40 bg-[linear-gradient(110deg,#ffe33b_0%,#ffd52d_68%,#ffc826_100%)] text-[#181306] shadow-[0_18px_45px_-28px_rgba(116,78,0,0.75)]",
        className
      )}
    >
      <div className="relative z-10 flex w-[68%] flex-col items-start justify-center gap-2.5 px-6 py-4 text-left @lg:w-[64%]">
        <div className="min-w-0">
          <h2 className="font-heading text-base leading-tight font-bold tracking-tight">
            {t("about.buy_me_a_coffee")}
          </h2>
          <p className="mt-1 text-xs leading-4 text-black/65">
            {t("about.buy_me_a_coffee_description")}
          </p>
        </div>
        <a
          href="https://www.buymeacoffee.com/gnehs"
          target="_blank"
          rel="noreferrer"
          className={cn(
            buttonVariants({ size: "sm" }),
            "rounded-full border border-black/5 bg-white pl-3 pr-2 text-[#181306] shadow-sm hover:bg-white/90"
          )}
        >
          {t("about.buy_me_a_coffee")}
          <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
        </a>
      </div>
      <img
        src={coffeeBannerIllustration}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="pointer-events-none absolute inset-y-0 right-6 z-0 h-full w-[44%] max-w-none object-contain object-right-bottom select-none @lg:w-[42%]"
      />
      {dismissible && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-2 right-2 z-20 rounded-full bg-black/10 text-black/65 hover:bg-black/20 hover:text-black"
          onClick={() => setIsVisible(false)}
          aria-label={t("translate.close")}
          title={t("translate.close")}
        >
          <X aria-hidden="true" />
        </Button>
      )}
    </motion.div>
  );
}
