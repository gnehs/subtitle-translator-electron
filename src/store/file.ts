import { createSlice } from "@reduxjs/toolkit";

export const fileSlice = createSlice({
  name: "file",
  initialState: {
    value: null,
  },
  reducers: {
    setFile: (state, action) => {
      state.value = action.payload;
    },
  },
});

// Action creators are generated for each case reducer function
export const { setFile } = fileSlice.actions;

export default fileSlice.reducer;
