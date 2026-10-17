import Link from "next/link";
import type { ReactNode } from "react";

import { formatAdminDate, TABLE_CLASS, TD_CLASS, TH_CLASS } from "@/components/admin/format";
import { formatPaiseAsRupees } from "@/lib/currency";
import { loadExceptions } from "@/server/admin/exceptions";
import { requireAdminPage } from "@/server/admin/page-guard";

function Section({ title, count, headers, children }: { title: string; count: number; headers: string[]; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-base font-semibold text-foreground">
        {title} ({count})
      </h2>
      {count === 0 ? (
        <p className="text-sm text-muted">None</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE_CLASS}>
            <thead>
              <tr>
                {headers.map((header) => (
                  <th key={header} className={TH_CLASS}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function OrderLink({ orderNumber }: { orderNumber: string | null | undefined }) {
  if (!orderNumber) return <>-</>;
  return (
    <Link href={`/admin/orders/${encodeURIComponent(orderNumber)}`} className="underline">
      {orderNumber}
    </Link>
  );
}

export default async function AdminExceptionsPage() {
  await requireAdminPage();
  const { orphans, paymentIssues, failedEmails, webhookErrors, stuckOrders, openReturns } = await loadExceptions();
  return (
    <main>
      <h1 className="mb-4 text-xl font-semibold text-foreground">Exceptions</h1>

      <section className="mb-8">
        <h2 className="mb-2 text-base font-semibold text-foreground">Order orphans</h2>
        <dl className="grid max-w-md grid-cols-[1fr_auto] gap-y-1 text-sm">
          <dt>Paid checkout sessions without an order</dt>
          <dd>{orphans.paidSessionsWithoutOrder}</dd>
          <dt>Captured payments unaccounted for</dt>
          <dd>{orphans.capturedPaymentsUnaccounted}</dd>
          <dt>Prepaid orders without a captured payment</dt>
          <dd>{orphans.ordersWithoutCapture}</dd>
        </dl>
      </section>

      <Section
        title="Payment issues"
        count={paymentIssues.length}
        headers={["State", "Reason", "Order", "Amount", "Attempts", "Last error", "Refund ID"]}
      >
        {paymentIssues.map((issue) => (
          <tr key={issue.id}>
            <td className={TD_CLASS}>{issue.state}</td>
            <td className={TD_CLASS}>{issue.reason}</td>
            <td className={TD_CLASS}>
              <OrderLink orderNumber={issue.payment?.order?.orderNumber} />
            </td>
            <td className={TD_CLASS}>{formatPaiseAsRupees(issue.amountPaise)}</td>
            <td className={TD_CLASS}>{issue.attempts}</td>
            <td className={TD_CLASS}>{issue.lastError ?? "-"}</td>
            <td className={TD_CLASS}>{issue.refundId ?? "-"}</td>
          </tr>
        ))}
      </Section>

      <Section
        title="Failed emails"
        count={failedEmails.length}
        headers={["Template", "Order", "Attempts", "Last error", "Updated"]}
      >
        {failedEmails.map((email) => (
          <tr key={email.id}>
            <td className={TD_CLASS}>{email.template}</td>
            <td className={TD_CLASS}>
              <OrderLink orderNumber={email.order?.orderNumber} />
            </td>
            <td className={TD_CLASS}>{email.attempts}</td>
            <td className={TD_CLASS}>{email.lastError ?? "-"}</td>
            <td className={TD_CLASS}>{formatAdminDate(email.updatedAt)}</td>
          </tr>
        ))}
      </Section>

      <Section
        title="Webhook events with processing errors"
        count={webhookErrors.length}
        headers={["Event type", "Event ID", "Error", "Received"]}
      >
        {webhookErrors.map((event) => (
          <tr key={event.id}>
            <td className={TD_CLASS}>{event.eventType}</td>
            <td className={TD_CLASS}>{event.providerEventId}</td>
            <td className={TD_CLASS}>{event.processingError}</td>
            <td className={TD_CLASS}>{formatAdminDate(event.receivedAt)}</td>
          </tr>
        ))}
      </Section>

      <Section
        title="Stuck orders (confirmed or preparing for over 48 hours)"
        count={stuckOrders.length}
        headers={["Order", "Status", "Placed", "Last updated"]}
      >
        {stuckOrders.map((order) => (
          <tr key={order.orderNumber}>
            <td className={TD_CLASS}>
              <OrderLink orderNumber={order.orderNumber} />
            </td>
            <td className={TD_CLASS}>{order.status}</td>
            <td className={TD_CLASS}>{formatAdminDate(order.placedAt)}</td>
            <td className={TD_CLASS}>{formatAdminDate(order.updatedAt)}</td>
          </tr>
        ))}
      </Section>

      <Section
        title="Returns and exchanges waiting on you (decide, receive, refund or ship the replacement)"
        count={openReturns.length}
        headers={["Order", "SKU", "Kind", "State", "Qty", "Refund due (by hand)", "Requested"]}
      >
        {openReturns.map((row) => (
          <tr key={row.id}>
            <td className={TD_CLASS}>
              <OrderLink orderNumber={row.orderNumber} />
            </td>
            <td className={TD_CLASS}>{row.sku}</td>
            <td className={TD_CLASS}>{row.kind}</td>
            <td className={TD_CLASS}>{row.state}</td>
            <td className={TD_CLASS}>{row.quantity}</td>
            <td className={TD_CLASS}>{row.refundDuePaise === null ? "-" : formatPaiseAsRupees(row.refundDuePaise)}</td>
            <td className={TD_CLASS}>{formatAdminDate(row.createdAt)}</td>
          </tr>
        ))}
      </Section>
    </main>
  );
}

// Reads the session via the admin guard: never prerender.
export const dynamic = "force-dynamic";
