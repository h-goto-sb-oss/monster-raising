// SkillList.jsx
// 「とくぎ」を選んだときに、行動中モンスターの習得済み技/呪文を一覧表示する。
// MPが足りない技は選択不可にする。

export default function SkillList({ actor, skillsById, onSelect, onBack }) {
  const skills = (actor.skills || []).map((id) => skillsById[id]).filter(Boolean);

  return (
    <>
      <div className="jrpg-wintitle">
        <span>とくぎ</span>
        <span className="jrpg-winsub">MP {actor.mp}/{actor.maxMp}</span>
      </div>
      {skills.length === 0 && <div className="mrg-note">おぼえている とくぎが ない</div>}
      <div className="mrg-list">
        {skills.map((skill) => {
          const usable = actor.mp >= skill.mpCost;
          return (
            <button
              key={skill.id}
              className="jrpg-btn jrpg-btn--wide"
              disabled={!usable}
              onClick={() => onSelect(skill)}
              title={skill.description}
            >
              <span className="mrg-row">
                <span className="mrg-grow">{skill.name}</span>
                <span className="mrg-count">{skill.type}/MP{skill.mpCost}</span>
              </span>
            </button>
          );
        })}
      </div>
      <button className="jrpg-btn jrpg-btn--back mrg-btn--back" onClick={onBack}>
        もどる
      </button>
    </>
  );
}
