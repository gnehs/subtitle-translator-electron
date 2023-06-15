import React from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";

import store from "./store";
import { Provider } from "react-redux";

import "./i18n";
import DefaultLayout from "./layouts/default";
import About from "./pages/about";
import Translator from "./pages/translator";
import Settings from "./pages/settings";
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
        element: <Settings />,
      },
      {
        path: "/about",
        element: <About />,
      },
    ],
  },
]);
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>
  </React.StrictMode>
);

postMessage({ payload: "removeLoading" }, "*");
