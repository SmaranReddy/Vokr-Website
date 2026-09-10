import { createMetadata } from "@/lib/metadata";
import { SupportPageShell } from "@/components/marketing/support-page-shell";
import { OrderStatusForm } from "@/components/marketing/order-status-form";
import { ORDER_STATUS_STEPS } from "@/config/support-content";

export const metadata = createMetadata({
  title: "Order Status",
  alternates: { canonical: "/support-order-status" },
});

export default function SupportOrderStatusPage() {
  return (
    <SupportPageShell
      title="Order Status"
      sub="Enter your order number and email to check where your Vokr shoes are."
    >
      <OrderStatusForm />
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {ORDER_STATUS_STEPS.map((step) => (
          <div key={step.title}>
            <h4 className="mb-1 text-sm font-bold">{step.title}</h4>
            <p className="text-sm text-muted">{step.body}</p>
          </div>
        ))}
      </div>
    </SupportPageShell>
  );
}
