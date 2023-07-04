import { useAutoAnimate } from "@formkit/auto-animate/react";
import type { GetStaticPaths, GetStaticProps } from "next";
import { useParams } from "next/navigation";
import { Fragment } from "react";
import { z } from "zod";

import { WipeMyCalActionButton } from "@calcom/app-store/wipemycalother/components";
import BookingLayout from "@calcom/features/bookings/layout/BookingLayout";
import type { filterQuerySchema } from "@calcom/features/bookings/lib/useFilterQuery";
import { useFilterQuery } from "@calcom/features/bookings/lib/useFilterQuery";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { RouterOutputs } from "@calcom/trpc/react";
import { trpc } from "@calcom/trpc/react";
import { Alert, Button, EmptyScreen } from "@calcom/ui";
import { Calendar } from "@calcom/ui/components/icon";

import { useInViewObserver } from "@lib/hooks/useInViewObserver";

import PageWrapper from "@components/PageWrapper";
import BookingListItem from "@components/booking/BookingListItem";
import SkeletonLoader from "@components/booking/SkeletonLoader";

import { ssgInit } from "@server/lib/ssg";

type BookingListingStatus = z.infer<NonNullable<typeof filterQuerySchema>>["status"];
type BookingOutput = RouterOutputs["viewer"]["bookings"]["get"]["bookings"][0];

type RecurringInfo = {
  recurringEventId: string | null;
  count: number;
  firstDate: Date | null;
  bookings: {
    [key: string]: Date[];
  };
};

const validStatuses = ["upcoming", "recurring", "past", "cancelled", "unconfirmed"] as const;

const descriptionByStatus: Record<NonNullable<BookingListingStatus>, string> = {
  upcoming: "upcoming_bookings",
  recurring: "recurring_bookings",
  past: "past_bookings",
  cancelled: "cancelled_bookings",
  unconfirmed: "unconfirmed_bookings",
};

const querySchema = z.object({
  status: z.enum(validStatuses),
});

export default function Bookings() {
  const searchParams = useParams();
  const { data: filterQuery } = useFilterQuery();
  const { status } = searchParams ? querySchema.parse(searchParams) : { status: "upcoming" };
  const { t } = useLocale();

  const query = trpc.viewer.bookings.get.useInfiniteQuery(
    {
      limit: 10,
      filters: {
        ...filterQuery,
        status: filterQuery.status ?? status,
      },
    },
    {
      // first render has status `undefined`
      enabled: true,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    }
  );

  // Animate page (tab) tranistions to look smoothing

  const buttonInView = useInViewObserver(() => {
    if (!query.isFetching && query.hasNextPage && query.status === "success") {
      query.fetchNextPage();
    }
  });

  const isEmpty = !query.data?.pages[0]?.bookings.length;

  const shownBookings: Record<string, BookingOutput[]> = {};
  const filterBookings = (booking: BookingOutput) => {
    if (status === "recurring" || status == "unconfirmed" || status === "cancelled") {
      if (!booking.recurringEventId) {
        return true;
      }
      if (
        shownBookings[booking.recurringEventId] !== undefined &&
        shownBookings[booking.recurringEventId].length > 0
      ) {
        shownBookings[booking.recurringEventId].push(booking);
        return false;
      }
      shownBookings[booking.recurringEventId] = [booking];
    } else if (status === "upcoming") {
      return new Date(booking.startTime).toDateString() !== new Date().toDateString();
    }
    return true;
  };

  let recurringInfoToday: RecurringInfo | undefined;

  const bookingsToday =
    query.data?.pages.map((page) =>
      page.bookings.filter((booking: BookingOutput) => {
        recurringInfoToday = page.recurringInfo.find(
          (info) => info.recurringEventId === booking.recurringEventId
        );
        return new Date(booking.startTime).toDateString() === new Date().toDateString();
      })
    )[0] || [];

  const [animationParentRef] = useAutoAnimate<HTMLDivElement>();

  return (
    <BookingLayout heading={t("bookings")} subtitle={t("bookings_description")}>
      <div className="flex w-full flex-col" ref={animationParentRef}>
        {query.status === "error" && (
          <Alert severity="error" title={t("something_went_wrong")} message={query.error.message} />
        )}
        {(query.status === "loading" || query.isPaused) && <SkeletonLoader />}
        {query.status === "success" && !isEmpty && (
          <>
            {!!bookingsToday.length && status === "upcoming" && (
              <div className="mb-6 pt-2 xl:pt-0">
                <WipeMyCalActionButton bookingStatus={status} bookingsEmpty={isEmpty} />
                <p className="text-subtle mb-2 text-xs font-medium uppercase leading-4">{t("today")}</p>
                <div className="border-subtle overflow-hidden rounded-md border">
                  <table className="w-full max-w-full table-fixed">
                    <tbody className="bg-default divide-subtle divide-y" data-testid="today-bookings">
                      <Fragment>
                        {bookingsToday.map((booking: BookingOutput) => (
                          <BookingListItem
                            key={booking.id}
                            listingStatus={status}
                            recurringInfo={recurringInfoToday}
                            {...booking}
                          />
                        ))}
                      </Fragment>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="pt-2 xl:pt-0">
              <div className="border-subtle overflow-hidden rounded-md border">
                <table className="w-full max-w-full table-fixed">
                  <tbody className="bg-default divide-subtle divide-y" data-testid="bookings">
                    {query.data.pages.map((page, index) => (
                      <Fragment key={index}>
                        {page.bookings.filter(filterBookings).map((booking: BookingOutput) => {
                          const recurringInfo = page.recurringInfo.find(
                            (info) => info.recurringEventId === booking.recurringEventId
                          );
                          return (
                            <BookingListItem
                              key={booking.id}
                              listingStatus={status}
                              recurringInfo={recurringInfo}
                              {...booking}
                            />
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-default p-4 text-center" ref={buttonInView.ref}>
                <Button
                  color="minimal"
                  loading={query.isFetchingNextPage}
                  disabled={!query.hasNextPage}
                  onClick={() => query.fetchNextPage()}>
                  {query.hasNextPage ? t("load_more_results") : t("no_more_results")}
                </Button>
              </div>
            </div>
          </>
        )}
        {query.status === "success" && isEmpty && (
          <div className="flex items-center justify-center pt-2 xl:pt-0">
            <EmptyScreen
              Icon={Calendar}
              headline={t("no_status_bookings_yet", { status: t(status).toLowerCase() })}
              description={t("no_status_bookings_yet_description", {
                status: t(status).toLowerCase(),
                description: t(descriptionByStatus[status]),
              })}
            />
          </div>
        )}
      </div>
    </BookingLayout>
  );
}

Bookings.PageWrapper = PageWrapper;

export const getStaticProps: GetStaticProps = async (ctx) => {
  const params = querySchema.safeParse(ctx.params);
  const ssg = await ssgInit(ctx);

  if (!params.success) return { notFound: true };

  return {
    props: {
      status: params.data.status,
      trpcState: ssg.dehydrate(),
    },
  };
};

export const getStaticPaths: GetStaticPaths = () => {
  return {
    paths: validStatuses.map((status) => ({
      params: { status },
      locale: "en",
    })),
    fallback: "blocking",
  };
};
