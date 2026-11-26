import { currentSingaporeMonth } from "@finscope/contracts/financial-accounts";
import type { CorrectFinancialAccount, FinancialAccount, ReportingPeriod } from "@finscope/contracts/financial-accounts";
import { assertSavedTradesFunded } from "../account-activity/trade-funding.service.ts";
import type { FinancialAccountRepository } from "./financial-accounts.repository.ts";
import { summarizeFinancialAccounts } from "./summary.ts";

type AccountCorrection =
  | { status: "saved"; account: FinancialAccount }
  | { status: "not_found" }
  | { status: "after_activity"; activityDate: string };

export function createFinancialAccountService(repository: FinancialAccountRepository) {
  return {
    async list(ownerUserId: string, period: ReportingPeriod = currentSingaporeMonth()) {
      const activity = await repository.listActivity(ownerUserId, period);
      return summarizeFinancialAccounts(activity.map((row) => ({ ...row, currency: "SGD" })), period);
    },
    open: repository.open,
    delete: repository.delete,
    correct(ownerUserId: string, accountId: string, input: CorrectFinancialAccount) {
      return repository.withCorrection<AccountCorrection>(ownerUserId, accountId, async (write) => {
        const earliestActivityDate = await write.findEarliestActivityDate();
        if (earliestActivityDate && input.openingDate > earliestActivityDate) {
          return { status: "after_activity", activityDate: earliestActivityDate };
        }

        const account = await write.update(input);
        if (!account) return { status: "not_found" };
        await assertSavedTradesFunded(write.readTradeFunding, [accountId]);
        return { status: "saved", account };
      });
    },
  };
}

export type FinancialAccountService = ReturnType<typeof createFinancialAccountService>;
