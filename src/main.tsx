import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";

import store from "./store";
import { Provider } from "react-redux";

import "./i18n";
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
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>
  </StrictMode>
);
