import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ReaderApp from "./ReaderApp";

createRoot(document.getElementById("reader-root")).render(
  <StrictMode>
    <ReaderApp />
  </StrictMode>,
);
