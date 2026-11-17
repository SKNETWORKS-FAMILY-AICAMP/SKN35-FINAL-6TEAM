import { OfficeBoard } from "./OfficeBoard";
import { OFFICE_FIXTURES, fixtureState } from "./officeFixtures";

function noop() {}

/** 개발 서버 전용 상태 견본(?office-gallery). 견본마다 이벤트를 접어 만든 실제 상태를 그립니다. */
export default function OfficeGallery() {
  return (
    <main className="office-gallery">
      <h1>사무실 상태 견본</h1>
      <p>시험용 이벤트를 접어 만든 화면입니다. 개발 서버에서만 열립니다.</p>
      {OFFICE_FIXTURES.map((fixture) => (
        <section
          key={fixture.id}
          className="office-gallery-item"
          aria-labelledby={`office-gallery-${fixture.id}`}
        >
          <header className="office-gallery-head">
            <h2 id={`office-gallery-${fixture.id}`}>{fixture.title}</h2>
            <p>{fixture.note}</p>
          </header>
          <div className="office-gallery-stage">
            <OfficeBoard state={fixtureState(fixture)} onRetry={fixture.retry ? noop : undefined} />
          </div>
        </section>
      ))}
    </main>
  );
}
