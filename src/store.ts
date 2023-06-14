import { configureStore } from "@reduxjs/toolkit";
import stepReducer from "./store/step";
export default configureStore({
  reducer: {
    step: stepReducer,
  },
});
