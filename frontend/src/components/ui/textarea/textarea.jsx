import React from "react";
import styles from "./textarea.module.css";

export const Textarea = React.forwardRef(({ className = "", rows = 3, ...props }, ref) => {
  return <textarea ref={ref} rows={rows} className={`${styles.textarea} ${className}`} {...props} />;
});
Textarea.displayName = "Textarea";
export default Textarea;
