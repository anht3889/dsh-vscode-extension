import React from "react";

/** Immediate on/off control used by MCP server and tool settings. */
export function McpSwitch({
  checked,
  label,
  disabled = false,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="dsh-mcp-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span
        className="dsh-mcp-switch-track"
        data-on={String(checked)}
        aria-hidden="true"
      >
        <span className="dsh-mcp-switch-thumb" />
      </span>
      {label}
    </button>
  );
}
