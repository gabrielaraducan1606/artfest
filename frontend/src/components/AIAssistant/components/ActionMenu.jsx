import React from "react";
import styles from "../AiAssistant.module.css";

import {
  BackIcon,
  ChevronRightIcon,
} from "../icons/AssistantIcons.jsx";

/*
 * FAZA 5 (polish vizual, INFLUENCER) - grupează acțiunile după
 * `action.group` (dacă e prezent) - USER/VENDOR nu au acest câmp pe
 * niciuna dintre acțiunile lor, deci pentru ele grupOf() întoarce
 * mereu un singur grup fără titlu, identic cu comportamentul vechi.
 */
function groupActions(actions) {
  const groups = [];
  const byKey = new Map();

  for (const action of actions) {
    const key = action.group || null;

    if (!byKey.has(key)) {
      const group = { title: key, actions: [] };
      byKey.set(key, group);
      groups.push(group);
    }

    byKey.get(key).actions.push(action);
  }

  return groups;
}

export default function ActionMenu({
  title,
  actions,
  canGoBack,
  onBack,
  onSelect,
  compact = false,
  roleHint,
}) {
  const groups = compact
    ? groupActions(actions)
    : [{ title: null, actions }];

  return (
    <div
      className={
        compact
          ? styles.quickActionsCompact
          : styles.quickActions
      }
    >
      {roleHint && (
        <p className={styles.assistantPanelRoleHint}>
          {roleHint}
        </p>
      )}

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

      {groups.map((group, groupIndex) => (
        <div key={group.title || `group-${groupIndex}`}>
          {compact && group.title && (
            <p className={styles.quickActionsGroupTitle}>
              {group.title}
            </p>
          )}

          <div
            className={
              compact
                ? styles.quickActionsPillGrid
                : styles.quickActionsList
            }
          >
            {group.actions.map((action) => {
              const Icon = action.icon;

              if (compact) {
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => onSelect(action.id)}
                    className={styles.quickActionPill}
                  >
                    <span
                      className={
                        styles.quickActionPillIcon
                      }
                    >
                      <Icon />
                    </span>

                    <span
                      className={
                        styles.quickActionPillLabel
                      }
                    >
                      {action.title}
                    </span>
                  </button>
                );
              }

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
      ))}
    </div>
  );
}
