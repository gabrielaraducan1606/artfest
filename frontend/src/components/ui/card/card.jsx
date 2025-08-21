import React from "react";
import styles from "./card.module.css";

export function Card({ className = "", ...props }) {
  return <div className={`${styles.card} ${className}`} {...props} />;
}
export function CardHeader({ className = "", ...props }) {
  return <div className={`${styles.header} ${className}`} {...props} />;
}
export function CardTitle({ className = "", ...props }) {
  return <div className={`${styles.title} ${className}`} {...props} />;
}
export function CardContent({ className = "", ...props }) {
  return <div className={`${styles.content} ${className}`} {...props} />;
}
export function CardFooter({ className = "", ...props }) {
  return <div className={`${styles.footer} ${className}`} {...props} />;
}
export default Card;
