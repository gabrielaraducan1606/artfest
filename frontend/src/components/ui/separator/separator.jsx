import React from "react";
import styles from "./separator.module.css";

export function Separator({ className = "", ...props }) {
  return <hr className={`${styles.sep} ${className}`} {...props} />;
}
export default Separator;
