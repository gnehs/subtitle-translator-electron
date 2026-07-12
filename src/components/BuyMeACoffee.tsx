import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "@/i18n";
import { Coffee, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      className={cn(
        "relative m-2 overflow-hidden rounded-lg border border-border/70 bg-muted/40",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center gap-3 px-3 py-2.5",
          dismissible ? "pr-11" : "pr-3"
        )}
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
          <Coffee size={17} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 text-left">
          <h2 className="text-sm font-semibold">{t("about.buy_me_a_coffee")}</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {t("about.buy_me_a_coffee_description")}
          </p>
        </div>
        <a
          href="https://www.buymeacoffee.com/gnehs"
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center justify-center gap-1 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-sm transition-colors hover:bg-foreground/85"
        >
          <Coffee size={15} aria-hidden="true" />
          {t("about.buy_me_a_coffee")}
        </a>
      </div>
      {dismissible && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute right-1 top-1"
          onClick={() => setIsVisible(false)}
          aria-label={t("translate.close")}
          title={t("translate.close")}
        >
          <X />
        </Button>
      )}
    </motion.div>
  );
}
