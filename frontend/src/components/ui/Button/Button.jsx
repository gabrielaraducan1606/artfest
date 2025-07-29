import React from "react";
import styles from "./Button.module.css";

export default function Button({ children, variant = "default", className = "", ...props }) {
  const classes = `${styles.button} ${variant === "outline" ? styles.outline : ""} ${className}`;
  return (
    <button className={classes} {...props}>
      {children}
    </button>
  );
}
