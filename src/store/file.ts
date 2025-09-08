import { createSlice } from "@reduxjs/toolkit";

export const fileSlice = createSlice({
  name: "file",
  initialState: {
    value: [],
  },
  reducers: {
    setFiles: (state, action) => {
      state.value = action.payload;
    },
  },
});

// Action creators are generated for each case reducer function
export const { setFiles } = fileSlice.actions;

export default fileSlice.reducer;
