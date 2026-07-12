import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { SubtitleFile } from "@/types/electron-api";

interface FileState {
  value: SubtitleFile[];
}

const initialState: FileState = { value: [] };

export const fileSlice = createSlice({
  name: "file",
  initialState,
  reducers: {
    setFiles: (state, action: PayloadAction<SubtitleFile[]>) => {
      state.value = action.payload;
    },
  },
});

// Action creators are generated for each case reducer function
export const { setFiles } = fileSlice.actions;

export default fileSlice.reducer;
