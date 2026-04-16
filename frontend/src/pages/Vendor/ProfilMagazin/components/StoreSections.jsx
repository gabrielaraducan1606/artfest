import React, { Suspense, lazy } from "react";
import TabsNav from "./TabsNav.jsx";
import AboutSection from "./AboutSection";
import InfoSection from "./InfoSection";

const ReviewsSection = lazy(() => import("./ReviewsSection.jsx"));
const ProductList = lazy(() => import("./ProductList"));

export default function StoreSections({
  tabs,
  activeTab,
  onJump,
  showAboutSection,
  aboutRef,
  infoRef,
  productsRef,
  reviewsRef,
  aboutText,
  isOwner,
  editAbout,
  aboutDraft,
  onToggleEditAbout,
  onChangeAbout,
  onSaveAbout,
  savingAbout,
  tags,
  niceCity,
  country,
  address,
  publicEmail,
  phone,
  website,
  leadTimes,
  prettyDelivery,
  editInfo,
  savingInfo,
  infoErr,
  infoDraft,
  onChangeInfoDraft,
  countySuggestions,
  countiesLoading,
  countiesErr,
  onCountiesChange,
  setEditInfo,
  saveInfoNow,
  trackCTA,
  products,
  viewMode,
  favorites,
  navigate,
  handleAddProduct,
  productsCacheT,
  openEditProduct,
  categories,
  rating,
  revState,
  me,
  changeQueryFromUI,
  onSubmitUserReview,
  onHelpful,
  onReport,
  onVendorReply,
  onDeleteUserReview,
  onVendorDeleteReply,
}) {
  return (
    <>
      <TabsNav items={tabs} activeKey={activeTab} onJump={onJump} />

      {showAboutSection && (
        <section
          id="despre"
          ref={aboutRef}
          data-tab-key="despre"
          className="sectionAnchorPad"
        >
          <AboutSection
            aboutText={aboutText}
            canEdit={isOwner}
            editAbout={editAbout}
            aboutDraft={aboutDraft}
            onToggleEditAbout={onToggleEditAbout}
            onChangeAbout={onChangeAbout}
            onSaveAbout={onSaveAbout}
            savingAbout={savingAbout}
          />
        </section>
      )}

      <section
        id="informatii"
        ref={infoRef}
        data-tab-key="informatii"
        className="sectionAnchorPad"
      >
        <InfoSection
          tags={tags}
          city={niceCity}
          country={country}
          address={address}
          publicEmail={publicEmail}
          phone={phone}
          website={website}
          leadTimes={leadTimes}
          prettyDelivery={prettyDelivery}
          editInfo={editInfo}
          savingInfo={savingInfo}
          infoErr={infoErr}
          infoDraft={infoDraft}
          onChangeInfoDraft={onChangeInfoDraft}
          countySuggestions={countySuggestions}
          countiesLoading={countiesLoading}
          countiesErr={countiesErr}
          onCountiesChange={onCountiesChange}
          canEdit={isOwner}
          onToggleEditInfo={() => setEditInfo((x) => !x)}
          onSaveInfo={saveInfoNow}
          onTrackCTA={trackCTA}
        />
      </section>

      <section
        id="produse"
        ref={productsRef}
        data-tab-key="produse"
        className="sectionAnchorPad"
      >
        <Suspense fallback={<div style={{ padding: 12 }}>Se încarcă produsele…</div>}>
          <ProductList
            products={products}
            isOwner={isOwner}
            viewMode={viewMode}
            favorites={favorites}
            navigate={navigate}
            onAddFirstProduct={handleAddProduct}
            productsCacheT={productsCacheT}
            onEditProduct={openEditProduct}
            categories={categories}
          />
        </Suspense>
      </section>

      <section
        id="recenzii"
        ref={reviewsRef}
        data-tab-key="recenzii"
        className="sectionAnchorPad"
      >
        <Suspense fallback={<div>Se încarcă recenziile…</div>}>
          <ReviewsSection
            rating={revState.stats?.avg ?? rating}
            reviews={revState.items}
            totalCount={revState.total}
            stats={revState.stats}
            canWrite={viewMode !== "vendor" && !!me}
            isVendorView={viewMode === "vendor"}
            me={me}
            onSubmit={onSubmitUserReview}
            onHelpful={onHelpful}
            onReport={onReport}
            onChangeQuery={changeQueryFromUI}
            onVendorReply={onVendorReply}
            onUserDeleteReview={onDeleteUserReview}
            onVendorDeleteReply={onVendorDeleteReply}
          />
        </Suspense>
      </section>
    </>
  );
}