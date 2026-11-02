# Shared controls

`core/global.css` is the global entry point. It imports `components/buttons.css`
and `components/forms.css`, so these components are available on every page,
including after client-side navigation. Change shared appearance here rather
than copying declarations into page styles.

## Actions

Use `class="cyrene-button"` on action buttons and action links, including controls
created in TypeScript. Use `cyrene-button--danger` for destructive actions, and `cyrene-button--icon` for a
compact icon-only action (supply an accessible label).

The base owns appearance, radius, focus, disabled treatment and motion.
Sizing belongs to each control: page styles may set padding, height, font size
and gap. Use `cyrene-button--compact` or `cyrene-button--large` for common sizes,
or override `--button-padding-block`, `--button-padding-inline` and
`--button-font-size`. A shared base does not mean equal dimensions.
Its pseudo-element uses a centred compositor transform instead of animated
layout edges. A shared ResizeObserver measures each button (including dynamic
buttons) so the horizontal and vertical shrink cover the same pixels. Content and the hit area stay
still. SVG icons use a shared 20px box. Do not add transforms or transitions to
page-specific action classes, or override the component's `::before`.

Global tokens include `--control-radius`, `--control-height`,
`--control-font-size`, `--control-padding-inline` and `--control-motion`.
Intent variants use `--button-surface`, `--button-hover`, `--button-border`
and `--button-hover-border`. Intent variants do not impose a size.

## Forms

Use the existing `.custom-select` structure for standard dropdowns:
`.custom-select-button`, `.custom-select-arrow`, `.custom-select-menu` and
`.custom-select-option`. Selected options use `.selected` or
`aria-selected="true"`. The shared `select-controls.ts` module owns opening, closing and keyboard
entry, preventing competing page handlers from toggling twice. Page scripts
still own option selection and account navigation.

Planner and Weapons value grids share the `.planner-choice-*` appearance.
Their page styles own popup placement and grid columns.

Use `.cyrene-input` for standalone text/password fields. Every
`input[type="search"]` is enhanced in place by `search-controls.ts`: one shared
42px field, an SVG magnifier and an accessible clear button. Native browser
clear icons are hidden. Existing input listeners remain attached, including
when markup is replaced during SPA navigation. Number inputs use
`.custom-input-wrapper`.
Keep colour pickers, calendar cells, switches, tabs and card selectors separate:
these have different interaction and sizing requirements.

All ordinary controls share `--control-surface`, `--control-hover-surface`,
`--control-border` and `--control-text`; dropdowns, search fields and checkbox
containers use the same palette as buttons. Interiors use the opaque inset
surface so tinted parent panels cannot make them pink; hover and selection
add only a restrained accent tint. Keep destructive colours in the
explicit danger variant.

Focus uses `--control-focus-border` (the subdued button border) without an extra
outline or glow on fields.

Page CSS may control size, width, placement, responsive layout, overflow and menu grid
columns. Reuse global styles for colours, borders, typography and focus rather
than introducing another visual variant. Load both global and page CSS when
checking controls; client-side navigation can expose conflicting page rules.

Import actions use `cyrene-import-button` with the label `Import`. This variant
shares the Weapons action sizing and appearance. Dropdown triggers use the
shared sizing across account, filter and value pickers. `--dropdown-height`
defaults to 40px to match Import and filter actions; compact Events toolbars use
36px, and Codes/custom-event forms use 42px to match their adjacent buttons;
page styles keep menu positioning and grid layouts, rather than overriding the trigger.
