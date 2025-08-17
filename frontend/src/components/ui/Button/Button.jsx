import React from "react";
import styles from "./Button.module.css";

export default function Button({
  children,
  variant = "default", // "default" sau "outline"
  size = "md",          // "sm", "md", "lg"
  className = "",
  ...props
}) {
  const classes = [
    styles.button,
    variant === "outline" ? styles.outline : "",
    size === "sm" ? styles.sm : "",
    size === "lg" ? styles.lg : "",
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={classes} {...props}>
      {children}
    </button>
  );
}