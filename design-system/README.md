# design-system/

Cópia do Trade UI (`~/design-systems/trade-ui/`) para o deploy não depender da máquina local. Não edite aqui: altere na fonte e copie de novo.

- `tokens/tokens.css` entra inline no `<style>` das páginas (`src/paginas.ts`); a CSP só aceita CSS inline, e o `@import` do Google Fonts é removido.
- `fonts/` é servido em `/ds/*.woff2` (`src/web.ts`). Plus Jakarta Sans (variável, latin) e Space Mono 400 (latin), ambas sob SIL Open Font License 1.1, obtidas via Fontsource.
