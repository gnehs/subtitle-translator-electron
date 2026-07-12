import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";

import store from "./store";
import { Provider } from "react-redux";

import { I18nProvider } from "@lingui/react";
import { defaultLocale, dynamicActivate, i18n, locales } from "./i18n";
import DefaultLayout from "./layouts/default";
import About from "./pages/about";
import Translator from "./pages/translator";
import "./index.css";
const router = createHashRouter([
  {
    path: "/",
    element: <DefaultLayout />,
    children: [
      {
        path: "/",
        element: <Translator />,
      },
      {
        path: "/settings",
        element: <Translator />,
      },
      {
        path: "/about",
        element: <About />,
      },
    ],
  },
]);
const storedLocale = localStorage.getItem("language");
const initialLocale = locales.find((locale) => locale === storedLocale) ?? defaultLocale;

async function bootstrap() {
  await dynamicActivate(initialLocale);

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <I18nProvider i18n={i18n}>
        <Provider store={store}>
          <RouterProvider router={router} />
        </Provider>
      </I18nProvider>
    </StrictMode>
  );
}

void bootstrap();
