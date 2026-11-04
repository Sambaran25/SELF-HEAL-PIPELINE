# Planted bugs (answer key)

The swarm only sees the shop through a browser, so this list is for scoring its findings. The source code has no comments pointing at the bugs, so the healer can't take shortcuts either.

| # | Bug | Where | How to reproduce |
|---|---|---|---|
| 1 | Search is case-sensitive | `server.js`, `/api/products` | Search for `mug`: no results. `Mug` finds the Coffee Mug. |
| 2 | Cart total ignores quantity | `app.js`, `cartSubtotal` | Add the Coffee Mug twice. The line shows $25.00 but the total shows $12.50. |
| 3 | Remove deletes the wrong item | `app.js`, `removeFromCart` | Add the Mug, then the Lamp. Click Remove on the Mug: the Lamp disappears. |
| 4 | Discount code stacks | `app.js`, discount form | Apply `SAVE10` ten times. The total drops to $0.00 and checkout charges nothing. |
| 5 | Out-of-stock items can be added | `app.js`, `renderProducts` | Click "Out of stock" on the Wireless Mouse: it is added to the cart. |
| 6 | Email is never validated | `server.js`, `/api/checkout` | Check out with the email `not-an-email`: the order is accepted. |
| 7 | Empty-cart checkout crashes | `server.js`, `/api/checkout` | Fill in name and email with an empty cart: "Something went wrong." (HTTP 500 instead of 400). |
