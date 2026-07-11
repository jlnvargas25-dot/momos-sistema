import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import MomosOps from "./MomosOps.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <MomosOps />
  </StrictMode>
);
