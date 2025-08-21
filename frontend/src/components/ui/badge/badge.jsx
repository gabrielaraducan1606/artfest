import React from "react";
import styles from "./badge.module.css";

const variants = {
  default: styles.default,
  destructive: styles.destructive,
  outline: styles.outline,
};

export const Badge = ({ variant = "default", className = "", ...props }) => (
  <span className={`${styles.base} ${variants[variant] || variants.default} ${className}`} {...props} />
);
export default Badge;
