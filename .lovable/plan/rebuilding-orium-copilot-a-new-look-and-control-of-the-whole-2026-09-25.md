# Rebuilding Orium Copilot: a new look and control of the whole Admin by conversation

The work comes in 4 stages. Each stage is delivered working and tested before the next one starts. This avoids one big change that breaks everything at once.

## Stage 1: New look and animations
- **Trigger:** the current floating bubble becomes the starting point of the animation. Tapping it makes the panel grow out of the bubble in about 300ms with a smooth curve. Closing plays the reverse. People who turn off motion on their device get a plain fade instead.
- **Panel:** on a computer it sits on the right, about 400–480px wide, with rounded corners, a faint border and a soft shadow. On a phone it opens full screen with a small header: close button, the Orium orb and the name "Copilot".
- **Background:** warm black and charcoal with a barely visible glow.
- **Orb:** a small golden ring drawn in code. It changes with each state:
  - Idle: almost still.
  - Listening: pulses with the loudness of your voice.
  - Thinking: turns slowly.
  - Running an action: a light moves around the ring.
  - Done: a short gold flash.
- **Header:** the orb, "Copilot" and a small line of text that only appears when something is happening: "Ouvindo…", "Pensando…", "Consultando estoque…", "Concluído". The green dot and "ORIUM COPILOT" in capitals are removed. New conversation, history and close become discreet icons.
- **Start screen:** the small orb, "O que você precisa?" and "Você pode falar ou escrever." Below that, a light list of 4 suggestions with arrows, plus "Mais ações".
- **Suggestions follow the page you're on:** in Produtos → Liquid Brun it offers "Alterar preço do Liquid Brun"; in Pedidos it offers "Ver pendentes".
- **Typing box:** a floating bar with **+**, the text "Digite ou fale com o Copilot…", a microphone and send. It stays above the phone keyboard and clear of the iPhone notch and home bar.
- **Microphone:** while you speak, the typing box turns into a sound wave with "Estou ouvindo…" and two buttons, Cancelar and Concluir. Then it shows "Você disse: …" followed by "Entendendo…".
- **Messages:**
  - Your messages sit on the right on a slightly raised background.
  - Copilot's replies have no bubble.
  - Messages slide in gently (about 200ms), and replies appear as they are being written.
- **Scrolling:** the chat follows new messages only when you're already at the bottom. If you scrolled up to read, a "Nova mensagem ↓" button appears instead.
- **Action cards:**
  - Each card shows a before → after (price, stock, coupon).
  - On Confirmar, the button shows a short loading state, then "✓ Alterado", and the card shrinks.
  - Errors appear gently with a clear message.
- **Step list while it works:** short lines such as "○ Buscando Liquid Brun" turning into "✓ Produto encontrado", written in plain words rather than a technical log.

## Stage 2: Commands you create by talking
- New actions in the Copilot: create, edit, delete and list commands.
  - A command has a name, the words you say, and one or more steps with settings.
  - Settings can be fixed (5%), asked for at the time (the coupon code), generated automatically, or taken from what you said ("estoque rápido, Liquid Brun 3").
- Commands can bundle several steps, for example FECHAMENTO = today's sales + gross profit + pending orders + pending restocking.
- **Flow:** it understands the request → shows a preview → asks about anything missing → you tap "Criar comando" → it saves → it confirms. You never need to open Configurações.
- When you say a command's words, the Copilot runs its steps using the same preview and confirmation rules as normal actions.
- Configurações → Copilot stays available, but you never have to use it.
- The Copilot will be told never to send you to another page when it has an action that can do the job. When no action exists yet, it will say "Essa ação ainda não está conectada ao Copilot" and won't claim it did something it didn't.

## Stage 3: Broader control of the Admin
Every action uses the same backend steps as the matching panel screen, so the rules and permissions are identical. Each action records its name, description, settings, required permission, risk level, confirmation level and whether it can be undone.
- **Products:** rename, change brand or category, hide or bring back, add a product by hand, look up suppliers. Stock, availability and price already exist.
- **Prices:** simulate, check margin, change wholesale price.
- **Coupons:** edit, delete, check usage. Creating and turning on/off already exist.
- **Promotions:** edit, schedule, look up.
- **Orders:** search, open, look up the customer, calculate totals.
- **Store sales:** edit, cancel or delete following the current rules, look up.
- **Restocking:** remove items, change supplier, plan the most efficient purchase, build the driving route.
- **Customers:** search, view history, edit the fields you're allowed to edit.
- **Brands:** edit, classify as Arabic / Designer / Niche, merge when safe.
- **Catalog check:** find duplicates, show suspicious merges, mark two products as different ("Yara ≠ Yara Elixir").
- **Suppliers:** sync, check that each connection is working, show errors.
- **Dashboard:** numbers by period and comparisons.
- **Navigation:** open a page, filter, product, order or customer.

## Stage 4: Context and confirmation
- **Three confirmation levels:**
  - None for lookups, reports and navigation.
  - A simple confirmation for price, stock, coupon, promotion, restocking and order changes.
  - A strong confirmation (retype or confirm twice) for deletions, merges, bulk actions and resets.
- **Voice confirmation:** say "sim" or "confirmar" when an action is waiting.
- **Pending actions expire** after 10 minutes. Anything older must be prepared again.
- **Memory of the conversation:**
  - It remembers the last product or order mentioned, so "coloca ele a 319" works.
  - It knows which product you have open, so "coloca esse como pronta entrega" works.
  - It continues an open question: after "Qual validade?", your answer "até domingo" goes to that question.
- **Permissions:** it only does what your own permission level (owner or admin) allows in the app. It never accesses the database directly.

## Tests
After each stage:
- Automated tests for the actions and commands (create, edit, delete, run with settings, compound commands).
- Automatic checks of the screens at 320, 390, 768, 1024 and 1440px, for open/close, keyboard and scrolling.
- The real flows: stock, price, coupon, custom command, restocking, orders, supplier and store sale.

The tests of your real data inside the Admin need a login with admin access in the preview. Until then, I can only test the parts that don't need login.

## Technical details
- Commands will use the existing command table, extended with steps and settings, keeping its access rules. Running a command expands it into normal action proposals.
- The registry gains a `permission`, `risk_level`, `confirmation: none|simple|strong`, `supports_undo` and `handler` field on every action, plus a check that no unknown action names are allowed.
- The panel gets a single animated container that remembers the bubble's position for the grow/shrink animation. The orb is SVG and CSS, and its state is driven by the chat status. The message list is memoized so that only the reply being written re-renders during streaming.
- The typing box follows the keyboard position on phones.
- Screen context (current page and open product or order) is sent with every message.
