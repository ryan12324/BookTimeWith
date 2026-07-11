export default function PublicPageLoading() {
  return (
    <div className="mx-auto flex justify-center px-0 sm:px-6 sm:pt-9">
      <div
        role="status"
        className="w-full max-w-[420px] bg-white px-[26px] py-16 text-center font-sans text-[13.5px] text-body sm:rounded-card-lg sm:border sm:border-line-soft sm:shadow-float"
      >
        Loading this booking page…
      </div>
    </div>
  );
}
