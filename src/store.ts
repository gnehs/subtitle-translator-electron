import { configureStore } from "@reduxjs/toolkit";
import stepReducer from "./store/step";
import fileReducer from "./store/file";
export default configureStore({
  reducer: {
    step: stepReducer,
    file: fileReducer,
  },
});
