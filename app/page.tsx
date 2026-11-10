import CalendarApp from "./CalendarApp";

export default function Home() {
  // Local UI verification uses isolated sample data and never connects to Firestore.
  const demo =
    process.env.NODE_ENV === "development" &&
    process.env.CALENDAR_UI_PREVIEW === "1";
  return <CalendarApp demo={demo} />;
}
