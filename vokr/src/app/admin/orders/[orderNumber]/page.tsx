import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { formatAdminDate, TABLE_CLASS, TD_CLASS, TH_CLASS } from "@/components/admin/format";
import { RefundForm } from "@/components/admin/refund-form";
import { RevealPii } from "@/components/admin/reveal-pii";
import { TransitionForm } from "@/components/admin/transition-form";
import { NotFoundError } from "@/lib/errors";
import { formatPaiseAsRupees } from "@/lib/currency";
import { getAdminOrder } from "@/server/admin/orders";
import { requireAdminPage } from "@/server/admin/page-guard";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
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
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

export default async function AdminOrderPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  await requireAdminPage();
  const { orderNumber: orderNumberParam } = await params;
  let order;
  try {
    order = await getAdminOrder(decodeURIComponent(orderNumberParam));
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const payment = order.payment;

  return (
    <main>
      <h1 className="mb-1 text-xl font-semibold text-foreground">Order {order.orderNumber}</h1>
      <p className="mb-6 text-sm text-muted">
        Placed {formatAdminDate(order.placedAt)} | {order.paymentMethod}
      </p>

      <Section title="Summary">
        <dl className="grid max-w-xl grid-cols-[10rem_1fr] gap-y-1 text-sm">
          <Row label="Status">{order.status}</Row>
          <Row label="Ship to">
            {order.shipCity}, {order.shipState} {order.shipPincode}
          </Row>
          <Row label="Courier">{order.courier ?? "-"}</Row>
          <Row label="AWB">{order.awb ?? "-"}</Row>
          <Row label="Tax invoice">
            {order.invoice ? (
              <a
                className="underline"
                href={`/api/admin/orders/${encodeURIComponent(order.orderNumber)}/invoice`}
                target="_blank"
                rel="noopener"
              >
                {order.invoice.invoiceNumber}
              </a>
            ) : (
              "Not issued (issued when the order ships)"
            )}
          </Row>
          {order.invoice ? (
            <Row label="Credit note">
              {order.creditNote ? (
                <a
                  className="underline"
                  href={`/api/admin/orders/${encodeURIComponent(order.orderNumber)}/invoice?type=credit-note`}
                  target="_blank"
                  rel="noopener"
                >
                  {order.creditNote.creditNoteNumber}
                </a>
              ) : order.status === "refunded" ? (
                "Pending — issued by the maintenance job within ~5 minutes"
              ) : (
                "None (issued automatically when a full refund completes)"
              )}
            </Row>
          ) : null}
          <Row label="Shipped at">{formatAdminDate(order.shippedAt)}</Row>
        </dl>
      </Section>

      <Section title="Payment">
        {payment ? (
          <dl className="grid max-w-xl grid-cols-[10rem_1fr] gap-y-1 text-sm">
            <Row label="Status">{payment.status}</Row>
            <Row label="Amount">{formatPaiseAsRupees(payment.amountPaise)}</Row>
            <Row label="Razorpay order ID">{payment.providerOrderId}</Row>
            <Row label="Razorpay payment ID">{payment.providerPaymentId ?? "-"}</Row>
          </dl>
        ) : (
          <p className="text-sm text-muted">No online payment (cash on delivery).</p>
        )}
      </Section>

      <Section title="Items">
        <Table
          headers={["SKU", "Name", "Size", "Colour", "HSN", "GST %", "Qty", "Unit price", "Line subtotal", "Line tax"]}
        >
          {order.items.map((item) => (
            <tr key={item.sku}>
              <td className={TD_CLASS}>{item.sku}</td>
              <td className={TD_CLASS}>{item.productName}</td>
              <td className={TD_CLASS}>{item.sizeLabel}</td>
              <td className={TD_CLASS}>{item.colorway}</td>
              <td className={TD_CLASS}>{item.hsnCode}</td>
              <td className={TD_CLASS}>{item.gstRateBps / 100}</td>
              <td className={TD_CLASS}>{item.quantity}</td>
              <td className={TD_CLASS}>{formatPaiseAsRupees(item.unitPricePaise)}</td>
              <td className={TD_CLASS}>{formatPaiseAsRupees(item.lineSubtotalPaise)}</td>
              <td className={TD_CLASS}>{formatPaiseAsRupees(item.lineTaxPaise)}</td>
            </tr>
          ))}
        </Table>
        <dl className="mt-3 grid max-w-xs grid-cols-[1fr_auto] gap-y-1 text-sm">
          <Row label="Subtotal">{formatPaiseAsRupees(order.subtotalPaise)}</Row>
          <Row label="Tax (incl.)">{formatPaiseAsRupees(order.taxPaise)}</Row>
          <Row label="Shipping">{formatPaiseAsRupees(order.shippingPaise)}</Row>
          <Row label="COD fee">{formatPaiseAsRupees(order.codFeePaise)}</Row>
          <Row label="Total">
            <strong>{formatPaiseAsRupees(order.totalPaise)}</strong>
          </Row>
        </dl>
      </Section>

      <Section title="Change status">
        <TransitionForm orderNumber={order.orderNumber} nextStatuses={order.nextStatuses} />
      </Section>

      {order.refundable && payment ? (
        <Section title="Refund">
          <RefundForm
            orderNumber={order.orderNumber}
            amountPaise={payment.amountPaise}
            invoiceNumber={order.invoice?.invoiceNumber ?? null}
          />
        </Section>
      ) : null}

      <Section title="Customer details">
        <RevealPii orderNumber={order.orderNumber} />
      </Section>

      <Section title="Status history">
        {order.history.length === 0 ? (
          <p className="text-sm text-muted">None</p>
        ) : (
          <Table headers={["From", "To", "Actor", "Note", "Time"]}>
            {order.history.map((entry, index) => (
              <tr key={index}>
                <td className={TD_CLASS}>{entry.fromStatus ?? "-"}</td>
                <td className={TD_CLASS}>{entry.toStatus}</td>
                <td className={TD_CLASS}>{entry.actor}</td>
                <td className={TD_CLASS}>{entry.note ?? "-"}</td>
                <td className={TD_CLASS}>{formatAdminDate(entry.createdAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Emails">
        {order.emails.length === 0 ? (
          <p className="text-sm text-muted">None</p>
        ) : (
          <Table headers={["Template", "Status", "Attempts", "Last error", "Sent"]}>
            {order.emails.map((email, index) => (
              <tr key={index}>
                <td className={TD_CLASS}>{email.template}</td>
                <td className={TD_CLASS}>{email.status}</td>
                <td className={TD_CLASS}>{email.attempts}</td>
                <td className={TD_CLASS}>{email.lastError ?? "-"}</td>
                <td className={TD_CLASS}>{formatAdminDate(email.sentAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Payment issues">
        {!payment || payment.issues.length === 0 ? (
          <p className="text-sm text-muted">None</p>
        ) : (
          <Table headers={["State", "Reason", "Amount", "Refund ID", "Last error", "Created"]}>
            {payment.issues.map((issue, index) => (
              <tr key={index}>
                <td className={TD_CLASS}>{issue.state}</td>
                <td className={TD_CLASS}>{issue.reason}</td>
                <td className={TD_CLASS}>{formatPaiseAsRupees(issue.amountPaise)}</td>
                <td className={TD_CLASS}>{issue.refundId ?? "-"}</td>
                <td className={TD_CLASS}>{issue.lastError ?? "-"}</td>
                <td className={TD_CLASS}>{formatAdminDate(issue.createdAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Audit trail">
        {order.audit.length === 0 ? (
          <p className="text-sm text-muted">None</p>
        ) : (
          <Table headers={["Actor", "Action", "Reason", "Time"]}>
            {order.audit.map((entry, index) => (
              <tr key={index}>
                <td className={TD_CLASS}>{entry.actor}</td>
                <td className={TD_CLASS}>{entry.action}</td>
                <td className={TD_CLASS}>{entry.reason ?? "-"}</td>
                <td className={TD_CLASS}>{formatAdminDate(entry.createdAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </main>
  );
}

// Reads the session via the admin guard: never prerender.
export const dynamic = "force-dynamic";
