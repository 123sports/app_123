import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isValidBookingDate } from "@/lib/booking-schedule";

const rescheduleSchema = z
  .object({
    bookingId: z.string().uuid(),
    newBookingDate: z.string().refine(isValidBookingDate, "Data de destino invalida."),
    newStartHour: z.number().int().min(6).max(22),
  })
  .strict();

export const reschedulePaidBookingServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rescheduleSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (supabaseAdmin as any).rpc("reschedule_paid_booking", {
      p_user_id: context.userId,
      p_booking_id: data.bookingId,
      p_new_booking_date: data.newBookingDate,
      p_new_start_hour: data.newStartHour,
    });

    if (error) {
      console.warn("[Bookings] Paid booking reschedule rejected", {
        bookingId: data.bookingId,
        userId: context.userId,
        code: error.code,
        message: error.message,
      });
      throw new Error(error.message || "Nao foi possivel trocar o horario.");
    }

    return result;
  });
