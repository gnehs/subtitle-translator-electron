import { createSlice } from "@reduxjs/toolkit";

export const stepSlice = createSlice({
  name: "step",
  initialState: {
    value: 1,
  },
  reducers: {
    nextStep: (state) => {
      state.value += 1;
    },
    previousStep: (state) => {
      state.value -= 1;
    },
  },
});

// Action creators are generated for each case reducer function
export const { nextStep, previousStep } = stepSlice.actions;

export default stepSlice.reducer;
