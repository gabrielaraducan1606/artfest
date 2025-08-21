import React from "react";
import styles from "./button.module.css";

const variants = {
  default: styles.default,
  ghost: styles.ghost,
};
const sizes = {
  default: styles.sizeDefault,
  sm: styles.sizeSm,
  lg: styles.sizeLg,
  icon: styles.sizeIcon,
};

export const Button = React.forwardRef(
  ({ className = "", variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`${styles.base} ${variants[variant] || variants.default} ${sizes[size] || sizes.default} ${className}`}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
export default Button;
