import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import "./i18n";
import DefaultLayout from "./layouts/default";
import About from "./pages/about";
import Translator from "./pages/translator";
import Settings from "./pages/settings";
import "./samples/node-api";
import "./index.css";
import "./index.sass";
const router = createBrowserRouter([
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
    <RouterProvider router={router} />
  </React.StrictMode>
);

postMessage({ payload: "removeLoading" }, "*");
