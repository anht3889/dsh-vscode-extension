import React, {
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
} from "react";
import type {
  PluginsSettingsView,
  SetCredentialCommand,
  UnsetCredentialCommand,
} from "@dsh-vscode/contract";
import { settingsText } from "../../localization/index.js";
import type { SettingsLocale } from "../../types.js";
import { PluginCard } from "./PluginCard.js";
import { PluginsController } from "./PluginsController.js";

interface PluginsSectionProps {
  controller: PluginsController;
  view: PluginsSettingsView;
  locale: SettingsLocale;
  onCredential(command: SetCredentialCommand | UnsetCredentialCommand): void;
}

const TABS = ["configurable", "all"] as const;
type PluginTab = typeof TABS[number];

export function PluginsSection({
  controller,
  view,
  locale,
  onCredential,
}: PluginsSectionProps): JSX.Element {
  const [, render] = useReducer((value: number) => value + 1, 0);
  const [active, setActive] = useState<PluginTab>("configurable");
  const id = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => controller.subscribe(() => render()), [controller]);
  useEffect(() => controller.updateView(view), [controller, view]);
  const snapshot = controller.snapshot();

  const select = (index: number): void => {
    const tab = TABS[index];
    if (tab === undefined) return;
    setActive(tab);
    tabRefs.current[index]?.focus();
  };

  return (
    <section className="dsh-settings-plugins" aria-label={settingsText(locale, "plugins")}>
      <div
        className="dsh-plugin-tabs"
        role="tablist"
        aria-label={settingsText(locale, "plugins")}
      >
        {TABS.map((tab, index) => {
          const selected = active === tab;
          const label = settingsText(
            locale,
            tab === "configurable" ? "pluginsConfigurable" : "pluginsAll",
          );
          return (
            <button
              key={tab}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={`${id}-tab-${tab}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${id}-panel-${tab}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab)}
              onKeyDown={(event) => {
                let next: number;
                switch (event.key) {
                  case "ArrowRight":
                    next = (index + 1) % TABS.length;
                    break;
                  case "ArrowLeft":
                    next = (index - 1 + TABS.length) % TABS.length;
                    break;
                  case "Home":
                    next = 0;
                    break;
                  case "End":
                    next = TABS.length - 1;
                    break;
                  default:
                    return;
                }
                event.preventDefault();
                select(next);
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div
        id={`${id}-panel-configurable`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-configurable`}
        hidden={active !== "configurable"}
      >
        {active === "configurable" ? (
          snapshot.cards.filter((card) => card.available).length === 0 ? (
            <p className="dsh-settings-empty">
              {settingsText(locale, "pluginsEmptyConfigurable")}
            </p>
          ) : (
            <div className="dsh-plugin-cards">
              {snapshot.cards.filter((card) => card.available).map((card) => (
                <PluginCard
                  key={card.namespace}
                  controller={controller}
                  card={card}
                  locale={locale}
                  onCredential={onCredential}
                />
              ))}
            </div>
          )
        ) : null}
      </div>
      <div
        id={`${id}-panel-all`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-all`}
        hidden={active !== "all"}
      >
        {active === "all" ? (
          <>
            <h3>{settingsText(locale, "pluginsInventory")}</h3>
            {snapshot.inventory.length === 0 ? (
              <p className="dsh-settings-empty">
                {settingsText(locale, "noResults")}
              </p>
            ) : (
              <ul className="dsh-plugin-inventory">
                {snapshot.inventory.map((item) => (
                  <li key={item.entryId}>
                    <strong>{item.moduleName}</strong>
                    <code>{item.entryId}</code>
                    <span>
                      {settingsText(
                        locale,
                        item.enabled ? "pluginsEnabled" : "pluginsDisabled",
                      )}
                    </span>
                    <span>
                      {settingsText(locale, "pluginsPhase")}:{" "}
                      {item.fiberPhase ?? settingsText(locale, "unavailable")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}
