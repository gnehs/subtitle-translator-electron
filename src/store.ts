import { configureStore } from "@reduxjs/toolkit";
import fileReducer from "./store/file";

const store = configureStore({
  reducer: {
    file: fileReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;
