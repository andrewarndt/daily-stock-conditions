# Stripe checkout links — handoff for wiring into the store

Handoff for whoever wires "Buy" buttons into `store/` (replacing or sitting beside the current
"Email to buy" `mailto:` buttons in `store/assets/products.js`, function `productCardHtml`).

All links are **LIVE** Stripe Payment Links on the 4A Holdings Company account (created 2026-10-09).
Clicking one opens a real checkout — do not test by completing a payment.

## Settings every link shares

- Shipping: United States only, flat **$9.00**, labeled "Flat rate shipping - Contiguous U.S. only (Alaska and Hawaii excluded)".
  Stripe cannot block Alaska/Hawaii (it only blocks by country), so that restriction is a **notice only**, not enforced.
  The site should say "Contiguous U.S. only" near each Buy button.
- Tax: off. Quantity: customer-adjustable, 1 to 100. Billing + shipping address collected.
- Customer receipts and owner "payment succeeded" alerts are on at the account level.
- Prices below are per item; shipping ($9.00) is added once per order at checkout.

## The links

| Site slug (`data/products.json`) | Option | Price | Checkout link |
|---|---|---|---|
| `damascus-knives` | One link for all handle colors (see note 1) | $20.00 | https://buy.stripe.com/8x228q8sP8TM2D93Sj3Ru0n |
| `pocket-knives` | Matte Black | $12.00 | https://buy.stripe.com/eVqaEWdN9c5Y5PlbkL3Ru00 |
| `pocket-knives` | Brushed Silver | $12.00 | https://buy.stripe.com/28E8wO7oL5HAfpV4Wn3Ru01 |
| `reed-diffusers` | Jasmine Maojin | $23.40 | https://buy.stripe.com/28EdR824rc5Y7Xt60r3Ru0k |
| `reed-diffusers` | Amber Sandalwood | $23.40 | https://buy.stripe.com/14AcN4cJ5gme2D91Kb3Ru0j |
| `reed-diffusers` | Romantic Lavender | $23.40 | https://buy.stripe.com/6oUfZg10nfiaa5BbkL3Ru0i |
| `ceramic-vessels` | Diffuser No Options | $15.75 | https://buy.stripe.com/eVqcN4bF18TM0v1fB13Ru0m |
| `ceramic-vessels` | Diffuser with Engraving | $19.75 | https://buy.stripe.com/cNi28q7oL3zsgtZ74v3Ru0l |
| `ceramic-vessels` | Diffuser with Oil | $29.75 | https://buy.stripe.com/9B65kC38v4Dw91x60r3Ru06 |
| `ceramic-vessels` | Diffuser with Oil and Engraving | $31.50 | https://buy.stripe.com/8x2aEWcJ51rkdhNbkL3Ru05 |

`water-bottles` has no link (deliberately skipped; it is "photos coming soon").

## Machine-readable version (suggested shape for `data/products.json`)

```json
{
  "damascus-knives": [
    { "label": "Handmade Damascus Knife (handle color varies)", "price": 20.00, "url": "https://buy.stripe.com/8x228q8sP8TM2D93Sj3Ru0n" }
  ],
  "pocket-knives": [
    { "label": "Matte Black", "price": 12.00, "url": "https://buy.stripe.com/eVqaEWdN9c5Y5PlbkL3Ru00" },
    { "label": "Brushed Silver", "price": 12.00, "url": "https://buy.stripe.com/28E8wO7oL5HAfpV4Wn3Ru01" }
  ],
  "reed-diffusers": [
    { "label": "Jasmine Maojin", "price": 23.40, "url": "https://buy.stripe.com/28EdR824rc5Y7Xt60r3Ru0k" },
    { "label": "Amber Sandalwood", "price": 23.40, "url": "https://buy.stripe.com/14AcN4cJ5gme2D91Kb3Ru0j" },
    { "label": "Romantic Lavender", "price": 23.40, "url": "https://buy.stripe.com/6oUfZg10nfiaa5BbkL3Ru0i" }
  ],
  "ceramic-vessels": [
    { "label": "Diffuser, no options", "price": 15.75, "url": "https://buy.stripe.com/eVqcN4bF18TM0v1fB13Ru0m" },
    { "label": "Diffuser with engraving", "price": 19.75, "url": "https://buy.stripe.com/cNi28q7oL3zsgtZ74v3Ru0l" },
    { "label": "Diffuser with oil", "price": 29.75, "url": "https://buy.stripe.com/9B65kC38v4Dw91x60r3Ru06" },
    { "label": "Diffuser with oil and engraving", "price": 31.50, "url": "https://buy.stripe.com/8x2aEWcJ51rkdhNbkL3Ru05" }
  ]
}
```

## Notes and known gaps

1. **Damascus knives — one link, color not selectable.** The owner asked for a single link for the Damascus knives.
   It is attached to the "Dark Green" price in Stripe, but all 11 colors are $45.00 and the product copy already says
   handle colors vary / each knife is unique, so the buyer does not choose a color at checkout. The owner chose
   "email for color preference": the site note tells buyers to email before ordering if they want a specific color.
2. **Ceramic vessels are sold WITHOUT oil (owner confirmed).** The site (`store/data/products.json`) therefore lists only
   the "Diffuser No Options" ($19.75, shown as "Blank") and "Diffuser with Engraving" ($21.75, shown as "Custom engraved")
   links. The two "with Oil" links still exist and work in Stripe but are intentionally NOT on the site.
3. **Quantity cap is not stock.** Quantity is limited to 1-100 per order. Stripe would not allow a total-payments limit
   on a link that lets customers adjust quantity, so there is no inventory cap. Stock levels still need to be managed by hand.
4. **Pocket knives have two links** (Matte Black and Brushed Silver). The owner's "one link for the knives" instruction was
   applied to the Damascus knives; the pocket knives were already done as two links. Ask the owner if they want that merged to one.
5. **No product photos on the new Stripe pocket-knife product.** The owner said they will upload those themselves
   (photos live in `store-photos/pocket-knives/`).
6. **Reed diffuser links were replaced (2026-10-09)** so receipts show the scent: each scent is now its own Stripe product
   ("Nesti Casa Reed Diffuser Set - <scent>"). The three old shared-product links (ending Ru07, Ru08, Ru09) should be
   deactivated once the updated site is live. The ceramic vessel product was renamed "Ceramic Reed Diffuser Vessel" (shared by
   Blank and Engraved, so the engraving is not in the receipt name).
7. Managing links: to change or remove a link, deactivate it in Stripe (Checkout > Payment links) and create a new one,
   then update the URL here. Links cannot have their price swapped after creation.

## Price change 2026-11-15

New prices and payment links created through the API (restricted key). The old links below were left
**active** until the owner confirms they can be deactivated:

| Item | Old price | New price | Old link (retire) | New link |
|---|---|---|---|---|
| Reed Lavender | $30.00 | $23.40 | https://buy.stripe.com/3cIcN4gZlgme5Pl9cD3Ru0c | https://buy.stripe.com/6oUfZg10nfiaa5BbkL3Ru0i |
| Reed Amber | $30.00 | $23.40 | https://buy.stripe.com/eVqaEWfVhb1U5PldsT3Ru0b | https://buy.stripe.com/14AcN4cJ5gme2D91Kb3Ru0j |
| Reed Jasmine | $30.00 | $23.40 | https://buy.stripe.com/aFaaEW9wT6LEdhN2Of3Ru0a | https://buy.stripe.com/28EdR824rc5Y7Xt60r3Ru0k |
| Vessel Custom | $21.75 | $19.75 | https://buy.stripe.com/14A8wO10n5HAcdJ74v3Ru04 | https://buy.stripe.com/cNi28q7oL3zsgtZ74v3Ru0l |
| Vessel Blank | $19.75 | $15.75 | https://buy.stripe.com/fZu4gy7oLc5Y5PldsT3Ru03 | https://buy.stripe.com/eVqcN4bF18TM0v1fB13Ru0m |
| Damascus | $45.00 | $20.00 | https://buy.stripe.com/8x2fZg9wT4Dw3HdcoP3Ru02 | https://buy.stripe.com/8x228q8sP8TM2D93Sj3Ru0n |
