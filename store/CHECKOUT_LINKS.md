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
| `damascus-knives` | One link for all handle colors (see note 1) | $45.00 | https://buy.stripe.com/8x2fZg9wT4Dw3HdcoP3Ru02 |
| `pocket-knives` | Matte Black | $12.00 | https://buy.stripe.com/eVqaEWdN9c5Y5PlbkL3Ru00 |
| `pocket-knives` | Brushed Silver | $12.00 | https://buy.stripe.com/28E8wO7oL5HAfpV4Wn3Ru01 |
| `reed-diffusers` | Jasmine Maojin | $30.00 | https://buy.stripe.com/bJefZgdN9c5Y5Pl3Sj3Ru07 |
| `reed-diffusers` | Amber Sandalwood | $30.00 | https://buy.stripe.com/aFadR8bF12vocdJ1Kb3Ru08 |
| `reed-diffusers` | Romantic Lavender | $30.00 | https://buy.stripe.com/cNiaEW6kH2voa5BdsT3Ru09 |
| `ceramic-vessels` | Diffuser No Options | $19.75 | https://buy.stripe.com/fZu4gy7oLc5Y5PldsT3Ru03 |
| `ceramic-vessels` | Diffuser with Engraving | $21.75 | https://buy.stripe.com/14A8wO10n5HAcdJ74v3Ru04 |
| `ceramic-vessels` | Diffuser with Oil | $29.75 | https://buy.stripe.com/9B65kC38v4Dw91x60r3Ru06 |
| `ceramic-vessels` | Diffuser with Oil and Engraving | $31.50 | https://buy.stripe.com/8x2aEWcJ51rkdhNbkL3Ru05 |

`water-bottles` has no link (deliberately skipped; it is "photos coming soon").

## Machine-readable version (suggested shape for `data/products.json`)

```json
{
  "damascus-knives": [
    { "label": "Handmade Damascus Knife (handle color varies)", "price": 45.00, "url": "https://buy.stripe.com/8x2fZg9wT4Dw3HdcoP3Ru02" }
  ],
  "pocket-knives": [
    { "label": "Matte Black", "price": 12.00, "url": "https://buy.stripe.com/eVqaEWdN9c5Y5PlbkL3Ru00" },
    { "label": "Brushed Silver", "price": 12.00, "url": "https://buy.stripe.com/28E8wO7oL5HAfpV4Wn3Ru01" }
  ],
  "reed-diffusers": [
    { "label": "Jasmine Maojin", "price": 30.00, "url": "https://buy.stripe.com/bJefZgdN9c5Y5Pl3Sj3Ru07" },
    { "label": "Amber Sandalwood", "price": 30.00, "url": "https://buy.stripe.com/aFadR8bF12vocdJ1Kb3Ru08" },
    { "label": "Romantic Lavender", "price": 30.00, "url": "https://buy.stripe.com/cNiaEW6kH2voa5BdsT3Ru09" }
  ],
  "ceramic-vessels": [
    { "label": "Diffuser, no options", "price": 19.75, "url": "https://buy.stripe.com/fZu4gy7oLc5Y5PldsT3Ru03" },
    { "label": "Diffuser with engraving", "price": 21.75, "url": "https://buy.stripe.com/14A8wO10n5HAcdJ74v3Ru04" },
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
6. Managing links: to change or remove a link, deactivate it in Stripe (Checkout > Payment links) and create a new one,
   then update the URL here. Links cannot have their price swapped after creation.
