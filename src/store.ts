import { configureStore } from "@reduxjs/toolkit";
import stepReducer from "./store/step";
import fileReducer from "./store/file";

const store = configureStore({
  reducer: {
    step: stepReducer,
    file: fileReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;
