import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "@/i18n";
import { ArrowUpRight, Coffee, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
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
        "@container relative m-2 overflow-hidden rounded-2xl border border-border/70 bg-linear-to-br from-muted/60 via-card to-card shadow-sm",
        className
      )}
    >
      <div
        className={cn(
          "relative flex flex-col gap-4 p-4 @md:flex-row @md:items-center @md:gap-5 @md:p-5",
          dismissible && "pr-12 @md:pr-12"
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3.5 text-left">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <Coffee size={24} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">
              {t("about.buy_me_a_coffee")}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t("about.buy_me_a_coffee_description")}
            </p>
          </div>
        </div>
        <a
          href="https://www.buymeacoffee.com/gnehs"
          target="_blank"
          rel="noreferrer"
          className={cn(
            buttonVariants({ size: "lg" }),
            "w-full gap-2 px-4 shadow-sm @md:w-auto"
          )}
        >
          <Coffee data-icon="inline-start" aria-hidden="true" />
          {t("about.buy_me_a_coffee")}
          <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
        </a>
      </div>
      {dismissible && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-2 right-2 rounded-full text-muted-foreground"
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
