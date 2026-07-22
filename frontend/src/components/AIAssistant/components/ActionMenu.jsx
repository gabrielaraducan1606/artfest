import React from "react";
import styles from "../AiAssistant.module.css";

import {
  BackIcon,
  ChevronRightIcon,
} from "../icons/AssistantIcons.jsx";

export default function ActionMenu({
  title,
  actions,
  canGoBack,
  onBack,
  onSelect,
}) {
  return (
    <div className={styles.quickActions}>
      <div className={styles.menuHeading}>
        {canGoBack && (
          <button
            type="button"
            onClick={onBack}
            className={styles.backButton}
            aria-label="Înapoi"
          >
            <BackIcon />
          </button>
        )}

        <p className={styles.quickActionsTitle}>
          {title}
        </p>
      </div>

      <div className={styles.quickActionsList}>
        {actions.map((action) => {
          const Icon = action.icon;

          return (
            <button
              key={action.id}
              type="button"
              onClick={() => onSelect(action.id)}
              className={
                styles["artfest-assistant-action"]
              }
            >
              <span>
                <Icon />
              </span>

              <span>
                <span>{action.title}</span>
                <span>{action.description}</span>
              </span>

              <ChevronRightIcon />
            </button>
          );
        })}
      </div>
    </div>
  );
}