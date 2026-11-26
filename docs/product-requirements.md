# FinScope product requirements

## Implemented in the repository

The personal workspace uses Google sign-in and admits the designated owner. The owner can open and correct SGD bank and brokerage accounts, see current cash and period cashflow on the Overview, and record, correct, or delete everyday income, expenses, and transfers. Both account histories show a transfer and the period's income and expenses exclude it. [Workspace](../apps/web/src/app/routes/workspace.tsx) · [Account and activity checks](../apps/api/test/transactions.test.ts)

The owner can record, correct, or delete SGD ETF buys and sells with fees. Brokerage holdings show units, costs, and realised profit or loss. An open holding awaits its first price and the portfolio shows a partial valuation with the known subtotal. Dated market-price entry remains part of the planned milestone walkthrough below. [Holdings view](../apps/web/src/features/investments/components/brokerage-holdings.tsx) · [ETF checks](../apps/api/test/etf-trades.test.ts)

## Confirmed for the first release

- Sign in with Google and create financial accounts associated with the signed-in user.
- Provide areas to manage accounts, transactions, investments, assets and liabilities, with an overview dashboard.
- Track bank and credit card accounts, income and expenses, budgets and savings goals.
- Record stock and ETF purchases and sales, preserving each trade's quantity and execution price. Show individual purchase costs, quantity held per security, average cost, portfolio valuation, and realised and unrealised profit or loss.
- Show total cashflows and assets in the overview.
- Track manually valued assets and liabilities with dated updates. Include account balances and investment holdings in the overview without requiring duplicate entries.
- Track monthly spending limits by category. A card purchase uses the budget in the month of purchase.
- Allow users to earmark money for a savings goal within an account. An allocation updates goal progress without changing the account balance or creating an expense.
- Allow users to start tracking from a chosen date with opening balances, without entering earlier activity.

## Financial rules

- Transfers between a user's own accounts do not count as income or expenses. Credit card repayments do not count purchases a second time.
- Use precise decimal arithmetic. Preserve original currencies and historical FX conversions. SGD is the primary reporting currency.
- Market price changes must preserve historical investment transactions.
- Distinguish CPF and illiquid assets from liquid funds. Keep property and mortgage values separate. Insurance coverage amounts are distinct from asset values.

## Timing and deferrals

Aim for a usable vertical slice in approximately two weeks. The first milestone is the SGD walkthrough below. Start with manual entry. Defer CSV import and statement reconciliation.

## Investment accounting

- Track units and running weighted-average cost separately for each security in each brokerage account. Aggregate holdings and profit across brokers for the portfolio view. Each sale uses the average cost immediately before that sale.
- Require the actual execution price per unit when recording every buy or sell. Show execution price per unit, quantity, gross trade amount, fees and net cash movement separately. Buy fees increase cost basis. Sell fees reduce proceeds. Show dividends separately as investment income.
- An opening holding accepts quantity and optional remaining total cost. With quantity alone, show market value when a price is available and mark cost-dependent profit as unknown. Show realised profit since tracking began. An opening holding alone provides no pre-start trade history.
- Track brokerage cash. A bank-to-broker transfer moves cash between accounts. A purchase or sale changes brokerage cash and units held. Show investment cash movements separately from everyday income and spending.

### Acceptance example

Buy 10 shares at S$100 with a S$5 fee. Display the S$100 execution price and S$5 fee separately. Brokerage cash falls by S$1,005 and average cost becomes S$100.50 per share. Sell four shares at S$110 with a S$2 fee. Gross proceeds are S$440, cash received is S$438 and realised profit is S$36 after deducting S$402 of cost. At a market price of S$110, the remaining six shares are worth S$660 against S$603 of cost, giving S$57 of unrealised profit.

## Multi-currency accounts and historical reporting

- Show a foreign holding's profit in its trading currency and SGD. Calculate SGD profit using historical SGD cost and the SGD value at valuation or sale. A sale fixes the realised SGD result using the recorded sale-date conversion.
- A brokerage account can hold cash in multiple currencies. Record both amounts of a currency exchange separately from any subsequent trade.
- Allow a foreign trade to be saved with its original quantity, price and fee while the historical SGD conversion is missing. Offer a dated reference rate with its source when available. Mark affected SGD profit as incomplete until the historical conversion is supplied.
- For an as-of report, use the latest available price and FX rate dated on or before the report date and show their dates. Flag holdings with missing valuation inputs and label the affected total as partial.

### Acceptance example

A holding bought for US$1,000 at S$1.35 per US dollar costs S$1,350. At US$1,020 and S$1.30 per US dollar it is worth S$1,326. Before fees, show an unrealised gain of US$20 and an unrealised loss of S$24.

## Spending, cashflow and card repayments

- Report spending by purchase date and cash movements by the date cash enters or leaves a cash account. Show both measures on the dashboard.
- Enter a transfer or card repayment once. Show it in both account histories and apply corrections to both balances together.
- Record a refund as a reduction of spending in the original category in the month received. Link it to the original purchase when available. A category can have negative monthly spending.
- Use one date per manually entered transaction in the first release. Use the purchase date for a card purchase, including its effect on the tracked card balance and budget.

### Acceptance example

A S$120 grocery purchase on 30 June adds S$120 to June spending and card debt, with no change in cash. Repaying S$120 on 5 July reduces bank cash and card debt by S$120 each and adds no July spending. A S$20 refund to the card later in July records negative S$20 of July grocery spending and credits the card S$20.

## Personal financial overview

- Calculate personal net worth from the user's attributable assets and liabilities. For shared items, the user enters their own share of each asset and debt separately.
- Show total cash with bank and brokerage balances broken out. Show cash earmarked for savings goals within that total. Allocations do not increase net worth.
- Accept dated manual balances for each CPF account. Include CPF in net worth and display it separately from cash and investments.
- Allow one loan repayment to be split into principal and interest. A S$1,000 bank payment with S$700 principal and S$300 interest reduces cash by S$1,000 and debt by S$700, and records S$300 of spending.

## Savings goals

- Give each goal a target amount and an optional target date. Show the amount funded and the amount remaining.
- Allocate money from specific accounts. A goal can draw from multiple accounts. Each dollar can be allocated only once.
- If a payment or transfer leaves an account with less cash than its allocations, record the transaction and show the shortfall alongside affected goals. Let the user revise allocations or move them to the receiving account.
- Let the user mark a goal completed, release its allocation and retain its achieved status in history. Completing a goal creates no additional expense.
- Defer intermediate milestones and contribution schedules. Deliver the product incrementally, starting with simple workflows.

## First milestone and delivery order

Target approximately two weeks for a signed-in user to complete one SGD walkthrough. Start with Google sign-in, manual opening balances for bank and brokerage cash, income, expenses, a bank-to-broker transfer, ETF buys and sells with fees, a dated manual market price and an overview dashboard.

### Owner access

Only the owner's designated Google identity may access FinScope during the personal milestone. Verify that the owner can open the dashboard and manage records, and that both a signed-out visitor and someone using a different Google account are denied access to financial records, including through direct requests. Invitations and shared access are deferred.

### Acceptance walkthrough

All amounts are in SGD. Start with 3,000 in the bank and zero in the brokerage account. Record income of 500, an expense of 100 and a transfer of 2,000 to the broker. Show the transfer in both histories and exclude it from income and spending.

Buy 10 ETF units at 50 with a fee of 2, then 10 at 60 with a fee of 2. Sell 5 at 65 with a fee of 1. Enter a dated market price of 62.

- Bank cash is 1,400 and brokerage cash is 1,220.
- The remaining 15 units have an average cost of 55.20, a remaining cost of 828 and a market value of 930.
- Fees total 5. Realised profit is 48 and unrealised profit is 102.
- Total tracked assets are 3,550. This also equals opening assets of 3,000 plus net everyday income of 400 plus investment profits of 150.

### Correcting a recorded trade

Allow the owner to correct a past trade. Recalculate affected cash balances, cost basis and realised and unrealised profit from that trade forward. Preserve the entered details of subsequent trades. Refreshing market prices only updates valuations.

In the walkthrough, correct the first purchase fee from 2 to 4. Brokerage cash becomes 1,218, average cost becomes 55.30 and total fees become 7. The sale remains 5 units at 65 with a fee of 1. Realised profit becomes 47.50 and unrealised profit becomes 100.50. Total tracked assets become 3,548.

### Validating sales

A sale may use at most the units of that security held in the selling brokerage account at the time of sale. Apply the same rule to later sales affected by a proposed correction. If a correction would leave only three units available for a recorded sale of five, identify the affected sale and its two-unit shortfall. Keep the existing records and balances intact until the user submits a valid correction. Short selling is deferred.

### Same-day execution order

Within a holding, use entry order by default for trades on the same date. Allow the owner to insert a forgotten trade at its actual execution position without entering a time. Use that sequence for availability checks and average-cost calculations, including when recalculating after a correction.

With no fees or opening units, buy 10 units at S$50, sell five at S$60, then buy 10 at S$70, all on one day. The sale realises S$50 of profit. The closing holding has 15 units and S$950 of remaining cost.

### Holding awaiting its first market price

Show “Awaiting price” until a dated market quote is entered or fetched. Display the units held and any known cost immediately. Leave market value and unrealised profit unavailable and label the portfolio total as partial. The execution price alone does not supply a valuation quote.

### Subsequent increments

1. Foreign-currency trades and an on-demand market price refresh. Show the fetched quote and its date for portfolio valuation. Refreshing a quote preserves the execution price of every recorded trade.
2. Credit card spending and budgets.
3. Savings goals and the broader asset and liability overview.
